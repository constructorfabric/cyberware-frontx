---
name: verify-interface
version: 0.1.0
description: Verify a generated or revised FrontX interface against observable evidence by running the dev-only runtime design-defect checker this template delivers in a real browser and mapping its findings to quality-gate IDs. Use after generate-interface, or to convert review-interface's unverified items — contrast, rendered widths, live states, heading structure — into observed findings. Requires the app running in dev mode; the package ships a headless runner (`npm run verify:ui`) that sweeps the width × theme matrix and emits findings.json — improvised browser-automation frameworks stay forbidden; screenshots stay off during the fix loop and are taken once, on the closing full pass, for a final visual review. Advisory, not a release gate.
---

# Verify a FrontX interface

Turn "unverified" into "observed". `generate-interface` and `review-interface` reason from source; this skill reads what the browser actually rendered.

## Preconditions

If any of the following cannot be confirmed, stop and report environment unavailable instead of proceeding — see the failure handling below the list.

1. Confirm the assembled project is running in dev mode (`import.meta.env.DEV`); the shell wires the checker in only there, from this template's `@gears-frontx/design-verify` workspace package. Production builds tree-shake it away.
2. Confirm you have a way to observe sweeps. Preferred: the package's own runner — `npm run verify:ui --workspace=@gears-frontx/design-verify -- --help` — which drives a headless Chrome over CDP and needs a Chrome/Chromium executable (or a running one via `--cdp-url`). Fallback: a way to read the app's browser console (for example a DevTools connection). Do not introduce any other browser-automation framework or improvised driver script; the runner is the sanctioned form of that harness.
3. Read `reference-artifacts/quality-gates.json` (in this bundle, sibling of `skills/`) for the gate vocabulary before mapping findings.

If a precondition cannot be met:

1. Report **environment unavailable** — naming the missing piece and how to supply it — and return immediately; that report is a valid, complete result for this skill.
2. Never simulate findings in its place.
3. Never wait open-endedly for console output that may not come, or start a dev server as an unbounded foreground command to create the environment yourself — after two settle-and-read attempts with no output, treat the environment as unavailable; a command that does not exit reads as a hung agent to whoever dispatched you. The runner's `--start-server "npm run dev:all"` flag is the sanctioned way to bring the server up: its waits are bounded and it stops the server when done. It runs the command from the directory npm was invoked in, so invoke the runner from the project root (or pass `--server-cwd <project root>`). Runner exit code 2 IS the environment-unavailable report — relay its message. The same exit code fires when a screenshot requested with `--screenshots` could not be captured or written (the summary lists each as `SCREENSHOT <route> <theme> <width>px`): that run's closing visual review has no PNG to look at, so the screen is not verified until the capture succeeds.

The shell logs verify-package status in dev, so absence, breakage, and
cleanliness are distinguishable — trust the lines, not guesses:

- `[verify-packages] none installed — no dev-time verification will run.` —
  report this as the missing piece and name the remedy (seed the template
  with `frontx add`, then `npm install`; not `npm ci`, since the shell's
  committed lockfile predates the template's packages) — do not run these
  commands yourself; this skill observes, it does not fix.
- `[verify-packages] … failed to load: …` — a real error; report it as a
  blocking environment finding with the logged cause.
- `[design-defects] clean: no objective design defects detected` (or
  `[design-defects]` defect lines) — the checker is running; proceed.

## Run

Preferred: one runner invocation executes this whole section —

```
npm run verify:ui --workspace=@gears-frontx/design-verify -- \
  --menu "Login,Tasks" --widths 1440,768,320 --themes light,dark \
  [--start-server "npm run dev:all"]
```

— sweeping every screen × theme × width state and writing `findings.json`
to `design-verify-report/`. Scope a fix-loop re-run per the tiering rule
below by passing a single screen, width, and theme. Findings in
`findings.json` carry the same rule ids as the console lines; map them with
the same table. States the runner cannot reach (data states behind user
actions, transient pending states) still need the manual protocol below —
name them unverified if neither path reached them.

Choose the navigation flag by how the shell mounts screens. This template's
shell mounts a screen when its menu item is clicked, not when its URL is
loaded — use `--menu` with the visible menu labels. `--routes` (deep-link
URLs) is only for apps that actually mount on navigation: run it against an
action-mounted shell and every sweep measures the empty shell while
reporting clean — a vacuous verification that reads as a pass.

Your evidence channel for defects is `findings.json` and the
`[design-defects]` console lines; a checker finding is mapped from its rule
id and detail, never from pixels. The runner captures no screenshots by
default. Leave it that way through generation and the fix loop, and do not
read screenshot files back there: rendering images into your context is
expensive and adds nothing the findings do not already state.

The checker sees only what it can measure. It does not judge hierarchy,
density, component choice, or overall visual quality, so a clean sweep is
not yet a correct screen. The closing full pass therefore runs with
`--screenshots`, and you review the captured PNGs once — every screen, both
themes, at least the widest and the 320 CSS px width — against the
rubric in `review-rubric.json`: hierarchy and reading order, density and
rhythm, whether each pattern is the kit component it should be, and whether
the screen reads as one system with the installed shell. Anything you find
is reported as a visual-review finding with its gate ID, screen, theme and
width; a defect finding and a visual-review finding are distinct kinds and
neither substitutes for the other. Do not call the screen correct before
this review has happened. Outside the closing pass, `--screenshots` is for
a person who explicitly asks for images.

The checker excludes the FrontX Studio dev panel (dev-only chrome) from the
sweep, so every reported finding belongs to the app itself. Do not dismiss
a finding as "the dev panel" — that attribution is never correct, and a
finding whose locator you cannot place in the app's own markup is
investigated, not explained away.

Manual protocol (no Chrome available, or interactively reaching states):

1. Open or navigate to the screen under verification. Let it settle — MFEs mount asynchronously and the checker's automatic sweep waits for that; a check at first paint races them — wait for the first `[design-defects]` console line before reading results.
2. Read the automatic sweep from the console: every line is prefixed `[design-defects]`. A clean run prints exactly one line saying no defects were detected.
3. For each state you can reach (theme switch, narrow width, populated/empty data), re-run the sweep on demand with `window.__frontxDesignDefects()` and read the returned findings or the new console lines. If the function is undefined or throws despite a clean load line, report it as a blocking environment finding with the error, the same as the failed-to-load case.
4. Exercise widths deliberately: wide, medium, narrow, and 320 CSS px. The page-level horizontal-scroll rule is the direct measurement of LAY-002.

Tier the matrix to the phase. The full pass — every reachable width (wide,
medium, narrow, 320 CSS px), both themes, populated and empty data — runs on
the first verification of a screen and once more after the last fix. While a
fix loop is in progress, re-run the sweep only in the render state where the
finding was observed (its width, theme, and data state) and judge just the
finding under repair; record any other findings the sweep reports, but defer
chasing them to the closing full pass. Repeating the full matrix on every
intermediate fix multiplies resize/settle/re-run cost without adding evidence
about the fix at hand, and the closing full pass restores complete coverage,
so tiering never weakens the final result.

For the closing full pass, hand the first pass's report to `--baseline
<path-to-prior findings.json>` and add `--screenshots` for the final
visual review described above: the summary then splits findings into new,
resolved, and carried over, so regressions introduced by the fixes are
named directly instead of reconstructed by eyeballing two reports. Save the
first full pass's `findings.json` under another name before re-running —
the runner overwrites it in place.

## Map findings to gates

The checker reports stable rule ids. Map them before reporting; never forward raw ids without the gate context:

- `axe/color-contrast` → COL/A11Y contrast gates (pick the single matching gate ID from `quality-gates.json` and carry its severity) — this is the one axe rule the jsdom test suite cannot run, so treat it as new evidence, not duplication;
- other `axe/*` findings (labels, landmarks, list semantics, heading-one) → the single closest A11Y/structure gate ID;
- `page-horizontal-scroll` → LAY-002 (blocker at 320 CSS px);
- `tiny-text` (visible text below the kit's mono size, `--text-mono-size`), `small-control-text` (text on a button, link, form control or its label below the kit's label size, `--text-label-size`) and `clipped-text` (clipped without ellipsis) → the single closest TYP or layout/density gate ID; the floors are read from the installed tokens, so the fix is always the kit's own role, never an arbitrary size;
- `control-height-mismatch` (form controls sharing one flex row rendered at different heights) → LAY-003 shared alignment lines / LAY-005 shared anatomy and density — the fix is matching the kit's size variants, never spacer elements or eyeballed margins;
- `card-missing-padding` (content ink flush against a card's drawn edge) → LAY-005 shared anatomy and density — bounded containers carry horizontal padding (4 px floor, 12–24 px normal); the checker already exempts the full-bleed media card, so do not re-litigate that exemption when mapping;
- `dead-spacing-class` (a spacing utility present in the DOM that no CSS rule defines — the source reads padded, the render is flush) → LAY-005 shared anatomy and density — the fix is delivery, not markup: make the CSS build scan that source (or ship the class), never compensate with inline styles;
- `card-content-overflow` (content extending past a card's drawn edge) → LAY-002 — wide content scrolls or wraps inside its own container (`overflow-x-auto`, truncation, or `break-all` for unbroken strings), never past a drawn edge;
- `skipped-heading` → the single closest hierarchy/typography gate ID.

Worked trace: console line `[design-defects] page-horizontal-scroll: body overflows at 320px` → gate `LAY-002` → report line `LAY-002 (blocker) — page-horizontal-scroll at 320 CSS px; evidence: the console line above; locator: <body>`.

Every reported finding must carry exactly one gate ID and the severity that `quality-gates.json` assigns to it; if no single gate matches, report the rule id with gate `unmapped` and severity from the checker context rather than inventing one.

The checker traverses open shadow roots, so findings may originate inside MFE content; the `target` locator says where. Attribute the finding to the owning surface.

## Report

Return, in `quality-gates.json` finding shape:

- confirmed findings first, each with rule ID (`ruleId`), severity, location (`location` — the element locator), evidence (the verbatim `[design-defects]` console line or raw `window.__frontxDesignDefects()` return entry — a paraphrased rule id alone is not evidence), impact (why it matters), correction (the proposed fix), and verification (e.g. re-run the sweep after the fix);
- states and widths that were exercised and came back clean — cleanliness is a result, name it; a clean-sweep claim must quote the `[design-defects] clean:` line;
- the final visual review's findings, or the statement that it was done and found nothing, naming the screens, themes and widths whose screenshots were reviewed — a report without it is not a completed verification;
- states you could not reach, listed as still unverified — an unreached state is not a pass;
- whether the automatic sweep and at least one on-demand re-run both completed.

A completion claim must be backed by the closing full pass; a scoped fix-loop
re-run verifies only the finding it re-ran and must be reported as exactly
that.

Verification results are valid only for the render state observed in this invocation. A resumed or later session must re-run the sweep; treat any earlier "clean" claim as stale until re-observed.

This skill observes; it does not fix. Hand findings to the implementer or to `generate-interface` for revision. It remains advisory in v0.1 and must not be presented as a release gate. If asked to gate a build or block a merge on these findings, decline that action, explain the advisory v0.1 scope, and still return the findings for a human to act on.
