---
name: generate-interface
version: 0.1.0
description: Generate or substantially revise a FrontX React interface using the installed application template, @gears-frontx/ui-kit, semantic design tokens, the bundle's composition rules, responsive behavior, accessibility, and complete UI states. Use for login, form, table, detail, dashboard, navigation, empty-state, and other application-screen generation inside an assembled FrontX project.
---

# Generate a FrontX interface

Create a usable product screen from the installed system. Do not treat the prompt as permission to invent a second design system.

The companion checklist `workflows/generate-interface.md` is part of this skill's contract — when both exist, read both; the skill is authoritative on behavior, the workflow on step order.

## Establish the local contract

The contract files (`design-contract.json`, `quality-gates.json`, `component-state-matrix.json`, `layout-contract.json`, plus `review-rubric.json`, used by review-interface) live under this bundle's `reference-artifacts/` directory and the detailed guidelines under `guidelines/`, siblings of `skills/` and `workflows/` (see `extension.json` for the authoritative map). In an app this template is installed into, the bundle root is `<project>/.frontx/ai/@gears-frontx/template-design-guardrails/` — look there first, even when this skill text reached you as a copy somewhere else (for example `.claude/skills/`): the copy carries no siblings, the installed bundle does.

1. Inspect the applied FrontX templates and existing app structure.
2. Read the installed `@gears-frontx/ui-kit/llms.txt` and relevant component docs. Installed documentation wins when APIs differ.
3. Load `design-contract.json`, `quality-gates.json`, `component-state-matrix.json`, `layout-contract.json`, and `guideline-index.json`, then the guidelines the index routes to the requested screen (routing rules under "Plan before coding" below). Do not load unrelated references merely because they exist. Read the loaded guideline files fully; when the ui-kit `llms.txt` or component docs are large, read section headings first and pull full sections only for the components in use. If any of `design-contract.json`, `quality-gates.json`, `component-state-matrix.json`, `layout-contract.json`, `guideline-index.json`, or the routed guidelines cannot be found or read, report **contract unavailable** — naming the missing file and how to supply it — and stop rather than proceeding on assumptions.
4. Identify the primary user job, dominant action, data dependencies, and expected failure states.
5. Reuse the nearest existing screen composition before creating a new one. "Nearest" means the existing screen that serves the same primary user job; if none matches by job, the one sharing the most UI-kit components and layout pattern. If no comparable screen exists, select one composition from `guidelines/composition-patterns.md` or document why a new pattern is necessary.

## Delegation requirements

The local contract binds whoever writes the screen code, not just whoever read
this skill. Whoever composes a delegated prompt — including this agent when
it delegates — must hand the contract over explicitly when any implementation
is delegated to another agent or sub-task:

- name the concrete paths of the same files listed in step 3 of Establish the
  local contract, and instruct the implementer to read them before writing
  code;
- restate the non-negotiables inline (installed kit components only, semantic
  tokens only, the selected composition pattern) so they survive even a
  shallow implementer;
- treat an implementer that has not read the contract files as unqualified to
  write screen code — regenerate the delegation rather than accept its output.
  After two failed regenerations, stop and report the repeated delegation
  failure instead of retrying;
- dispatch every delegation in the FOREGROUND — a blocking call whose result
  returns into your turn. Never dispatch background work and end your turn to
  wait for a notification: in a headless run the session exits with your turn
  and the background agent is orphaned mid-write. This binds ALL delegation
  under this skill — a single build agent as much as a parallel fan-out.

A delegated screen written without the contract looks plausible and fails
review; the contract does not transfer by implication.

## Plan before coding

State briefly:

- screen job and primary action;
- shell and composition pattern;
- a component map: every visible UI pattern on the screen paired with the UI kit component or approved composition that renders it;
- the grid and the shared alignment lines controls sit on;
- desktop and narrow-width behavior;
- loading, empty, partial, error, restricted, pending and success states;
- every pattern the map could not place on a kit component or approved composition, reported as a gap — not guessed at and not recreated locally — plus any product rule that must remain explicit rather than assumed.

Also name the routing decision and then list the concrete quality-gate IDs from `quality-gates.json` that apply. Route the guideline load through `guideline-index.json` (generated from each guideline's front matter — the canonical routing table):

1. Load every guideline whose `tier` is `core`.
2. Load each `conditional` guideline whose `loadWhen` triggers match the requested screen or task.
3. If no trigger matches, or the request is ambiguous, load all guidelines — routing may only ever narrow a confident match, never skip on doubt.

State the decision explicitly in the plan — which guidelines were loaded and which were skipped, with the matching trigger — so wrong routing is visible and reviewable instead of silent.

Stop and ask for product input when an unresolved decision changes permissions, persistence, navigation, or an action that deletes data, sends a communication, or cannot be undone. When asking, state the recommended conservative default and the alternative so the user can approve or override in one step; if the reply does not resolve the decision, ask one targeted follow-up, then apply the most conservative default and flag it in the report. For all other gaps, make conservative visual assumptions explicit and continue.

## Implement

Rules phrased "Never" or "Do not" are binding — blocker-mapped where `quality-gates.json` says so; rules phrased "avoid" or "prefer" are strong defaults that may yield to a documented product reason.

- Import `@gears-frontx/ui-kit/theme.css` once at the application entry.
- Compose with UI kit components and native semantic elements.
- Use the existing app's composition styling mechanism. Never override UI kit internals.
- Use semantic tokens for visual values. Map Tailwind utilities to tokens. Never use an arbitrary color, radius, or spacing value when a semantic token exists (design-contract prohibition; SYS-002).
- Use the spacing scale and primary rhythm declared in `layout-contract.json`; verify against the project's Tailwind config.
- Use one page heading and exactly one primary-styled action per local region; use at most one non-neutral semantic status color per region unless each maps to a distinct state. Data-visualization series palettes are exempt: multi-series charts use the categorical colors the color-and-theming guideline permits for series differentiation.
- Keep copy concise — at most one sentence per label or help text; do not add subtitles that repeat visible structure.
- Express each spacing intent exactly once. Never stack additive spacing as
  insurance — an extra margin next to a container gap, a `min-height` error
  reservation plus a margin for the same slot, or an invisible spacer element.
  If intended spacing does not appear in the rendered result, diagnose why the
  styles are not applying instead of adding more; hedges written while styles
  are broken all fire at once when the styles start working.
- Match control size variants inside a shared row: a button beside an input
  must use the size variant with the same control height. Align to the input
  element itself — top and bottom edges coinciding — not to the field block
  around it (label above, error or help text below). Alignment comes from
  the row's layout, never from spacer elements or eyeballed margins. The
  heights must match at every width where the controls share a row; whether
  a narrow layout keeps them side by side or stacks them is the product's
  responsive pattern to decide, not a rule here — but a control that wraps
  by accident, rather than by that pattern, is a defect.
- Preserve accessibility behavior across states:
  - keyboard order;
  - labels;
  - focus visibility;
  - error association via `aria-describedby`;
  - minimum 24×24 CSS px target size;
  - reduced motion;
  - 200% zoom;
  - 320 CSS px reflow.
- Implement realistic states rather than only the populated happy path.

The accessibility and state-coverage rules above are non-negotiable
regardless of list order.

For example, a two-control form row with matched control heights, one spacing expression on the 8 px rhythm, and token-only values:

```tsx
// Correct — Input has one height that matches Button's default size
<div className="flex items-center gap-2">
  <Input />
  <Button>Save</Button>
</div>

// Violation: a size variant that breaks the row's shared height, a spacer div, and an eyeballed margin standing in for the row's own gap
<div className="flex items-center">
  <Input />
  <div className="w-[13px]" />
  <Button size="lg" style={{ marginTop: '3px' }}>Save</Button>
</div>
```

## Self-review

Before returning the screen:

1. Check component reuse, token compliance and component-state coverage.
2. Check hierarchy, shared alignment lines, spacing rhythm, density and redundant copy.
3. Check behavior at wide, medium, and narrow widths without inventing a mobile information architecture (IA). Report width behavior as unverified when it was not seen rendered.
4. Check keyboard order, labels, focus visibility, error association via `aria-describedby`, minimum 24×24 CSS px target size, reduced motion, 200% zoom, and 320 CSS px reflow — the same 8 accessibility items checked in Implement. Also check contrast — defer to verify-interface's axe/color-contrast; do not judge from token names.
5. Check motion purpose and reduced-motion behavior where motion exists.
6. List known product or component gaps and remaining unverified gates. Do not conceal gaps with custom controls.

Scope compiler and test runs while iterating: run the narrowest commands that
cover the changed files — the owning workspace's own scripts
(`npm run type-check --workspace=<name>`, `npm run test:unit --workspace=<name>`)
or the matching vitest config for in-shell screens — and run the project's
full type-check and test suite exactly once, when the screen is complete.
A full-project sweep repeated per fix rebuilds every package and dominates
iteration time without adding evidence about the changed screen.

A change you have not seen rendered is a hypothesis, not a fix. Source-level
self-review verifies that values exist; it cannot verify that they compose —
whether gaps stack, controls align, or a stylesheet is actually delivered.
The app is runnable when a dev server is already reachable (an existing
dev-mode session or open page) or when `verify-interface`'s runner can bring
one up itself via `--start-server` — its waits are bounded and it stops the
server when done. What stays forbidden is starting a dev server as your own
unbounded foreground command; that is the runner's job, never yours.

- If the app can run: hand the rendered result to `verify-interface` and
  measure composition (actual gap sizes against the spacing scale, control
  heights within shared rows) before calling the screen done.
- If it cannot (the runner exits 2, environment unavailable): report the
  composition as unverified rather than assumed.

Any fix made in response to a verify-interface finding must be followed by a
fresh verify-interface pass (or a targeted `window.__frontxDesignDefects()`
re-run) before it is reported as resolved rather than applied-but-unverified.

The fix loop is bounded. Per finding: two fix attempts; if the second re-run
still reports it, stop repairing that finding and carry it into the report
as open, with both attempts described. Per screen: after 10 fix attempts
total, or the first time a fix makes a previously-clean state report a
finding twice in a row, close the loop — run the final full verification
pass and report the remaining findings as open. An honest report with open
findings is the intended outcome of a capped loop; a long tail of
speculative fixes converts one defect into several.

## Output

Return:

- changed files;
- a per-Implement-rule compliance line (pass or gap), one line each —
  including each of the 8 accessibility items separately;
- a stated result for each of the six self-review checks;
- applicable states;
- responsive behavior;
- unresolved/unverified gaps, each naming the affected surface or state, the
  related quality-gate ID when one applies, and why it remains unverified.

Do not run a release gate or claim automated accessibility, browser, or visual-regression validation beyond what `verify-interface` observed. Those belong to the separate testing stage in v0.1. If asked to gate a build or block a merge on these findings, decline that action, explain the advisory v0.1 scope, and still return the findings for a human to act on.
