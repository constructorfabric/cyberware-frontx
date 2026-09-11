---
name: create-theme
version: 0.1.0
description: Author or revise a FrontX shell theme against the @gears-frontx/ui-kit token contract — full CSS color values, declared light/dark appearance, derived hover and alpha tokens, complete variable coverage. Use when adding a brand or product theme, porting an existing palette, or when kit components render unstyled, transparent, or with wrong dark-mode surfaces after a theme change.
---

# Create a FrontX theme

A theme is a `ThemeConfig` object registered with the shell, not a stylesheet. Its variables feed both the host document and every MFE (micro-frontend) shadow root, and the UI kit consumes them as-is — which makes the value format a token-value contract, not a convention.

## Establish the token contract

1. Read the nearest existing theme in the app (`src-app/app/themes/`) and copy its full variable set as the starting point. A theme that defines only the colors it cares about leaves the rest resolving to another theme's leftovers. If no theme exists yet, enumerate every kit-consumed token from the installed UI-kit documentation and declare all of them explicitly instead of copying a sibling theme.
2. Read the installed UI-kit documentation for the semantic roles and the tokens the kit consumes directly. The kit is the only token source; there is no bundle fallback set. When a kit-consumed token cannot be mapped from available context, ask the user for that token's value before finishing; fall back to the base value and flag it only if no answer is available.

## Value format rules

These are the failure modes actually observed; each one renders as "kit looks broken", not as an error:

- **Every color token is a full CSS color** — `hsl(240 10% 3.9%)`, a hex value, `oklch(...)`. Never an HSL fragment like `240 10% 3.9%`: the kit consumes tokens as `var(--x)` directly, and a fragment there is an invalid value, so the component silently loses its color. The repository's token-format CI gate bans the matching consumer pattern `hsl(var(--x))` for the same reason.
- **Declare `appearance: 'light' | 'dark'`** on every theme. The shell stamps it as `data-theme` on the document element, and the kit's dark-surface tokens (elevated surfaces, overlays) switch on that attribute — a dark theme without the declaration gets light kit surfaces.
- **Derive hover tokens, don't invent them.** The kit expects `--primary-hover` and `--card-hover`; derive them from their base so they follow palette edits: `color-mix(in oklab, var(--primary) 90%, var(--background))`. After authoring, grep the theme's hover/alpha tokens for the `color-mix(` derivation from their base — a visually correct hardcoded value still fails this check.
- **Alpha via `color-mix`**, never by re-wrapping a token: `color-mix(in oklab, var(--border) 50%, transparent)`.
- Fallbacks, where needed, go inside `var()`: `var(--x, hsl(0 0% 100%))`.

## Register and verify

1. Register the theme where the app's existing themes are registered (the themes index feeding the theme registry).
2. Verify live in dev mode, not just by reading source: switch to the new theme and inspect a host screen **and** a screen rendered inside an MFE shadow root — theme propagation into shadow roots is a separate code path from the host document.
3. Toggle against a theme of the opposite appearance and confirm the kit's surface tokens (card, overlay, background) resolve to the new appearance in both the host document and one MFE shadow root via computed styles.
4. Run the repository token-format guard when present; note it only catches the consumer pattern `hsl(var(--x))` — always also grep the new theme's own declared values for bare fragments and hardcoded hover values, since the guard cannot see producer-side defects; run `verify-interface` (or the runtime design-defect checker directly) with the new theme active — `axe/color-contrast` is the objective check on the chosen palette.

If dev mode or shadow-root inspection cannot be reached, report **environment unavailable** — naming the missing piece — and report the theme as registered-but-unverified; never start a dev server as a foreground command.

## Report

Before the Report, state pass/fail for each of the five value-format rules by inspecting the theme's declared values: (1) every color token is a full CSS color; (2) no HSL fragments; (3) appearance declared; (4) hover/alpha tokens derived via `color-mix` from their base, not hardcoded; (5) no token re-wrapping. A theme is not reportable as done with any rule unchecked.

Name:

- the theme id and its appearance;
- which tokens differ from the theme you started from;
- any kit-consumed token you could not map and left at the base value;
- the verification evidence — host + shadow-root screens observed, contrast findings;
- states not switched to — list them as unverified instead of claiming the theme works there.
